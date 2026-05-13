---
created: "<% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>"
type: scratch-day
day: "<% tp.date.now("YYYY-MM-DD") %>"
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchDayList", args: [{ day: dv.current().day }] });
```
