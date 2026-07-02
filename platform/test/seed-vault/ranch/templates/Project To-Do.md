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

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Project Tasks", top: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskProjectList" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });
```

<!-- OWNED_TASKS_MARKER -->

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList", args: [{ anchor: "ownedTasks" }] });
```
