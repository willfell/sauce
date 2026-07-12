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
  args: [{ key: "flights",
           fields: [{name:"airline",label:"Airline",placeholder:"Delta"},
                    {name:"flight_no",label:"Flight #",placeholder:"DL123"},
                    {name:"from",label:"From",placeholder:"DEN"},
                    {name:"to",label:"To",placeholder:"DTW"},
                    {name:"depart_at",label:"Departs",placeholder:"2026-08-01 09:00"},
                    {name:"arrive_at",label:"Arrives",placeholder:"2026-08-01 13:00"},
                    {name:"confirmation",label:"Confirmation",placeholder:"ABC123"}],
           title: e => (e.airline||"")+" "+(e.flight_no||""),
           subtitle: e => (e.from||"")+" -> "+(e.to||"")+"  "+(e.depart_at||"") }]
});
```
