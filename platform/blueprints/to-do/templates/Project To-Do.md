---
type: project-todo
project: "{{prompts.project_link}}"
project_slug: "{{prompts.slug}}"
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ProjectNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoLeafActions" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
```

<!-- OWNED_TASKS_MARKER -->

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "EditableTaskList", args: [{ sectionAnchor: "ownedTasks" }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });
```
