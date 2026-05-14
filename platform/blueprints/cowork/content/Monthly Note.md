---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
type: cowork-monthly
tags: ["{{vault_identity_tag}}", monthly]
month_label: <% moment(tp.file.title, "YYYY-MM").format("YYYY-MM") %>
month_start: <% moment(tp.file.title, "YYYY-MM").startOf("month").format("YYYY-MM-DD") %>
month_end: <% moment(tp.file.title, "YYYY-MM").endOf("month").format("YYYY-MM-DD") %>
---

> [[Cowork|◀ Cowork]] · [[Daily Hub]] · [[Weekly Hub]] · [[Monthly Hub]]

# <% tp.file.title %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

<!-- COWORK_CALLOUTS -->

## Notes
