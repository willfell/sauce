---
type: trip-section
section_kind: packing-list
section: "Packing List"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
packing_items: []
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "packing_items", kind: "packing", group: true, checkbox: true }]
});
```
