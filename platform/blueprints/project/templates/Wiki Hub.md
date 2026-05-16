---
type: wiki-hub
project: "[[{{prompts.name}}]]"
project_slug: {{prompts.slug}}
project_name: {{prompts.name}}
created: {{now.YYYY-MM-DD HH:mm}}
tags:
  - wiki-hub
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

---

```dataviewjs
// entity-create:wiki-note — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "AccentButton", args: [{ id: "wiki-note", label: "+ New Wiki Note", icon: "file-plus" }] });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWikiCards" });
```
