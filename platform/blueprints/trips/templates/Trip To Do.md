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
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Trip Tasks" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskTripList", method: "render" });
```
