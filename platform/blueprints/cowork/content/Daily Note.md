<%*
const day = tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD");
const dayMoment = window.moment(day, "YYYY-MM-DD", true);
const weekday = dayMoment.format("dddd");
const monthName = dayMoment.format("MMMM");
const dayNum = dayMoment.format("D");
const year = dayMoment.format("YYYY");
const friendly = `${weekday}, ${monthName} ${dayNum}, ${year}`;
const created = window.moment().format("YYYY-MM-DDTHH:mm:ss");
-%>
---
type: cowork-daily
tags: [cowork-daily, daily]
day: "<% day %>"
day_label: "<% friendly %>"
created: "<% created %>"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

---

# <% friendly %>

## Notes
