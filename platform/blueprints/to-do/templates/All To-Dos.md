---
type: to-do-hub
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoHubActions" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoAllList" });
```
