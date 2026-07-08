---
type: trip
name: "{{NAME}}"
created_at: "{{DATE}}"
start_date: "{{START_DATE}}"
end_date: "{{END_DATE}}"
location: "{{LOCATION}}"
people: []
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripSectionsCards" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Mentions" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "BacklinkPanel",
  method: "render",
  args: [{ entityType: "trip" }]
});
```
