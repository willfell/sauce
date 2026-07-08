---
type: trips-hub
created_at: "2026-05-17T15:30:00-06:00"
tags:
  - trips-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "All Trips" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripsHubCards" });
```
