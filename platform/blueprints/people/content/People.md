---
type: people-hub
tags:
  - people-hub
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:person — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "person" });
```

---

## All People

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PeopleHubCards" });
```
