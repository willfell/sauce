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
  args: [{ key: "packing_items", group: true, checkbox: true,
           fields: [{name:"category",label:"Category",placeholder:"Clothing"},
                    {name:"item",label:"Item",placeholder:"Socks"}],
           title: e => e.item, subtitle: e => e.category }]
});
```
