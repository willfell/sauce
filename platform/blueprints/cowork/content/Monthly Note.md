<%*
const m = tp.file.title.match(/^(\d{4})-(\d{2})$/);
const year = m ? m[1] : window.moment().format("YYYY");
const month = m ? m[2] : window.moment().format("MM");
const mo = window.moment(`${year}-${month}-01`, "YYYY-MM-DD");
const monthName = mo.format("MMMM");
const friendly = `${monthName} ${year}`;
const monthStart = mo.clone().startOf("month").format("YYYY-MM-DD");
const monthEnd = mo.clone().endOf("month").format("YYYY-MM-DD");
const created = window.moment().format("YYYY-MM-DDTHH:mm:ssZ");
-%>
---
type: cowork-monthly
tags: [monthly]
month_label: "<% friendly %>"
month: "<% year %>-<% month %>"
month_start: "<% monthStart %>"
month_end: "<% monthEnd %>"
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

%% COWORK_CALLOUTS %%

## Notes
