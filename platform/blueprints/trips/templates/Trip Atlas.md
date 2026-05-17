---
type: trip
name: "{{NAME}}"
created_at: "{{DATE}}"
start_date: {{START_DATE}}
end_date: {{END_DATE}}
location: "{{LOCATION}}"
people: []
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripSectionsCards" });
```
