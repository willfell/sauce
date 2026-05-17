---
type: person
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
company:
location:
title:
email:
website:
aliases:
phone:
tags:
---
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PersonNavButtons" });
```

# [[<% tp.file.title %>]]

## Notes
-

## Meetings
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", {
  class: "PeopleRendering",
  method: "renderMentionList",
  args: [dv, { mode: "mentioning_person", personLink: dv.current().file.link, scopePath: "spice/meetings" }, { style: "cards", limit: 50 }]
});
```

## Daily Mentions
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", {
  class: "PeopleRendering",
  method: "renderMentionList",
  args: [dv, { mode: "mentioning_person", personLink: dv.current().file.link, scopePath: "spice/daily" }, { style: "list", limit: 30 }]
});
```
<%* await tp.file.move("spice/people/" + tp.file.title) %>
