---
type: cowork-today-hub
created_at: "2026-05-18T23:30:00-06:00"
tags: [cowork-hub, today-hub]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

# Today

## Today's daily note

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{ scope: "today", blueprints: ["daily", "cowork-daily"], groupBy: "none", limit: 1 }]
});
```

## Today's meetings

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{ scope: "today", blueprints: ["meeting"], groupBy: "none", limit: 20 }]
});
```

## Today's scratches

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{ scope: "today", blueprints: ["scratch", "scratch-day"], groupBy: "none", limit: 20 }]
});
```

## Today's project status changes

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{ scope: "today", blueprints: ["project"], groupBy: "none", limit: 20, useStatusChangedAt: true }]
});
```
