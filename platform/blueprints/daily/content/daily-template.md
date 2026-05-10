---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
tags:
  - "{{vault_identity_tag}}"
  - daily
  - "<% tp.date.now('YYYY/MM/DD') %>"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceDailyDashboard" });
```

<!-- COWORK_CALLOUTS -->

## Notes

