---
type: docs-hub
project: "[[My Cool Project]]"
project_slug: my-cool-project
project_name: My Cool Project
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - docs-hub
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
// entity-create:doc-note — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "doc-note" }] });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });
```
