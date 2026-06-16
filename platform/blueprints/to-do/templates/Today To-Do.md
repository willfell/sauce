---
type: to-do
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoLeafActions" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyCarryover" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyRecurring" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyProjectGroups" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });
```
