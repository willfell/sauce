---
created: {{now.YYYY-MM-DD HH:mm}}
type: map
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
