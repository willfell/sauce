---
type: projects-hub
tags:
  - projects-hub
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

<!-- entity-create:project -->
```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "project" });
```

---

## All Projects

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectsHubCards" });
```
