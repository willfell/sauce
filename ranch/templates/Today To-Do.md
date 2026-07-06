---
type: to-do
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskTodayList" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskDoneTodayList" });
```
