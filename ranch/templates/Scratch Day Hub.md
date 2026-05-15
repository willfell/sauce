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

<!-- entity-create:scratch -->
```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "scratch" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchDayList", args: [{ day: dv.current().day }] });
```
