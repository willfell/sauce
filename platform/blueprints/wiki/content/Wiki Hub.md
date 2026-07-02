---
type: wiki-hub
title: Wiki
dir: spice/wiki
created_at: "2026-07-01T18:00:40-06:00"
tags:
  - wiki-hub
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:wiki-section — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-section" }] });
```

```dataviewjs
// entity-create:wiki-page — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-page" }] });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiTree" });
```
