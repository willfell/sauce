---
created: "<% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>"
type: scratch
day: "<% tp.date.now("YYYY-MM-DD") %>"
time: "<% tp.date.now("HH:mm") %>"
day_link: "[[Scratch-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ScratchLeafActions" });
```

---

