---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
tags:
  - "{{vault_identity_tag}}"
  - meetings-hub
cssclasses:
  - wide
  - cards
  - cards-cols-2
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Meetings", top: true }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingsBrowseList" });
```
