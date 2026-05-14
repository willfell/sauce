---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
type: cowork-weekly
tags: ["{{vault_identity_tag}}", weekly]
week_label: <% moment(tp.file.title, "YYYY-[W]ww").format("YYYY-[W]ww") %>
week_start: <% moment(tp.file.title, "YYYY-[W]ww").startOf("isoWeek").format("YYYY-MM-DD") %>
week_end: <% moment(tp.file.title, "YYYY-[W]ww").endOf("isoWeek").format("YYYY-MM-DD") %>
---

> [[Cowork|◀ Cowork]] · [[Daily Hub]] · [[Weekly Hub]] · [[Monthly Hub]]

# <% tp.file.title %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

<!-- COWORK_CALLOUTS -->

## Notes
