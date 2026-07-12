---
type: trip-section
section_kind: stay
section: "Stay"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
stays: []
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "stays", kind: "stay" }]
});
```
