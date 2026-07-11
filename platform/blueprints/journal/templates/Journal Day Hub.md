---
type: journal-day
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalDayList", args: [{ day: dv.current()?.day }] });
```
