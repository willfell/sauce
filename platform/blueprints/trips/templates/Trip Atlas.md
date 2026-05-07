---
type: trip
created: {{DATE}}
start_date: {{START_DATE}}
end_date: {{END_DATE}}
location: "{{LOCATION}}"
attending:
tags:
  - trip
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "TripNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "TripSectionsCards" });
```
