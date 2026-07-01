---
type: wiki-section
title: Infra
dir: spice/wiki/infra
created_at: "2026-06-01T00:00:00Z"
tags:
  - wiki-section
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:wiki-section — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-section" }] });
```

```dataviewjs
// entity-create:wiki-page — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-page" }] });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "WikiTree" });
```
