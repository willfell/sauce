---
type: to-do
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskTodayList" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyRecurring" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyProjectGroups" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyTripGroups" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskDoneTodayList" });
```
