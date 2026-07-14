---
type: trip-section
section_kind: flights
section: "Flights"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
flights: []
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "flights", kind: "flights" }]
});
```
