---
type: map
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - project/{{prompts.slug}}
workstreams: []
---

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
