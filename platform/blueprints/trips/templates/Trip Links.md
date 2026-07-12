---
type: trip-section
section_kind: links
section: "Links"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
links: []
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripLinksManager", method: "render" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripLinksPanel", method: "render" });
```
