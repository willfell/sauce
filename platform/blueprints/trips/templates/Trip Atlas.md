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
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "TripNavButtons" });
```

---

# {{NAME}}

**Dates:** {{START_DATE}} — {{END_DATE}}
**Location:** {{LOCATION}}

---

## Trip Details

- [[Flights]] — Flight info
- [[Stay]] — Lodging details
- [[Packing List]] — What to bring
- [[To Do]] — Pre-trip tasks
- [[Notes]] — Free-form notes
