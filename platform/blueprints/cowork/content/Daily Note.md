<%*
const day = tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD");
const dayMoment = window.moment(day, "YYYY-MM-DD", true);
const weekday = dayMoment.format("dddd");
const monthName = dayMoment.format("MMMM");
const dayNum = dayMoment.format("D");
const year = dayMoment.format("YYYY");
const friendly = `${weekday}, ${monthName} ${dayNum}, ${year}`;
const created = window.moment().format("YYYY-MM-DDTHH:mm:ssZ");
-%>
---
type: cowork-daily
tags: [daily]
day: "<% day %>"
day_label: "<% friendly %>"
created_at: "<% created %>"
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
