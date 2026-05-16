---
type: projects-hub
tags:
  - projects-hub
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:project — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "project" });
```

---

## All Projects

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectsHubCards" });
```
