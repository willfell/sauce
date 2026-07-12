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
  args: [{ key: "stays",
           fields: [{name:"name",label:"Name",placeholder:"Beachside Resort"},
                    {name:"address",label:"Address",placeholder:"123 Ocean Dr"},
                    {name:"check_in",label:"Check-in",placeholder:"2026-08-01"},
                    {name:"check_out",label:"Check-out",placeholder:"2026-08-05"},
                    {name:"confirmation",label:"Confirmation",placeholder:"HTL999"}],
           title: e => e.name,
           subtitle: e => (e.check_in||"")+" -> "+(e.check_out||"") }]
});
```
