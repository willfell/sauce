---
type: map
project_name: "{{prompts.name|sanitize-filename}}"
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - project/{{prompts.slug}}
workstreams: []
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager", args: [{ contentOnly: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreams" });
```
