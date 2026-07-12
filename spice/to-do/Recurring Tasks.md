---
type: to-do-recurring
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoChromeBar" });
```


```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring Tasks", top: true }] });
```

<!-- Each line is a template. Sauce parses these on daily-note creation; matching ones get freshly copied into today's daily. Do not check these off — check the copy in your daily note. -->

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Last 7 days of materialization" }] });
```

<!-- Audit log; auto-appended by ToDoDailyRecurring. -->

| Date | Title | Routed to |
| --- | --- | --- |
