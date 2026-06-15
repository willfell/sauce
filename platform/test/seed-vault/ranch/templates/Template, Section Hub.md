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
// entity-create:section-hub — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "section-hub" });
```

```dataviewjs
// entity-create:sub-section-hub — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "sub-section-hub" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionHub" });
```
