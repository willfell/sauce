<%*
const wk = tp.date.now("YYYY-[W]ww", 0, tp.file.title, "YYYY-[W]ww");
const m = tp.file.title.match(/^(\d{4})-W(\d{2})$/);
const year = m ? m[1] : window.moment().format("YYYY");
const weekNum = m ? m[2] : window.moment().format("ww");
const isoMoment = window.moment(`${year}-W${weekNum}-1`, "YYYY-[W]ww-E");
const weekStart = isoMoment.clone().startOf("isoWeek");
const weekEnd   = isoMoment.clone().endOf("isoWeek");
const startStr  = weekStart.format("MMM D");
const endStr    = weekEnd.format("MMM D");
const friendly  = `Week ${weekNum} · ${startStr}–${endStr}, ${year}`;
const created   = window.moment().format("YYYY-MM-DDTHH:mm:ssZ");
-%>
---
type: cowork-weekly
tags: [weekly]
week_label: "<% friendly %>"
week_iso: "<% year %>-W<% weekNum %>"
week_start: "<% weekStart.format("YYYY-MM-DD") %>"
week_end: "<% weekEnd.format("YYYY-MM-DD") %>"
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

[//]: # (COWORK_CALLOUTS)

## Notes
