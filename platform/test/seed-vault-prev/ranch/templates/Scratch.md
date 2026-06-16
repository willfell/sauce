---
type: scratch
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
time: "<% tp.date.now("HH:mm") %>"
day_link: "[[Scratch-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchLeafActions" });
```

---

