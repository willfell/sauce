---
type: project
name: "{{NAME}}"
created: {{DATE}}
status: idea
status_changed_at: {{DATE}}
description: ""
tags:
  - project
  - project/{{SLUG}}
  - {{DATE_TAG}}
workstreams: []
teams: []
products: []
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

---

## Workstreams

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
```

---

> [!example]- Project Notes & Referenced By
>
> #### Project Notes
> ```dataviewjs
> await dv.view("ranch/views/customjs-guard", { class: "ProjectNotesCards" });
> ```
>
> #### Referenced By
> ```dataviewjs
> await dv.view("ranch/views/customjs-guard", { class: "ProjectReferencedByCards" });
> ```
