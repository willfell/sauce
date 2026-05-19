---
type: cowork-weekly-hub
created_at: "2026-05-17T15:03:00-06:00"
tags: [cowork-hub, weekly-hub]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

# Weekly Notes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkWeeklyHubCards" });
```

## This Week's Activity

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{ scope: "week", groupBy: "blueprint", limit: 100 }]
});
```
