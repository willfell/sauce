---
type: journal-entry
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
time: "<% tp.date.now("HH:mm") %>"
day_link: "[[Journal-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```
