---
type: to-do
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "seed-test-vault"
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

<!-- TODAY_CAPTURE_MARKER -->

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });
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
