---
type: trip-section
section_kind: to-do
section: "To Do"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripToDoActions", method: "render" });
```
