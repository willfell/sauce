---
type: task-note
project_name: "{{PROJECT_NAME}}"
created_at: "{{DATE}}"
task_parent: {{TASK_PARENT_PATH}}
aliases:
  - "{{ALIAS}}"
tags:
  - task-note
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

