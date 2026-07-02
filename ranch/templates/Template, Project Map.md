---
type: map
project_name: "{{prompts.name|sanitize-filename}}"
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - project/{{prompts.slug}}
workstreams: []
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
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreams" });
```
