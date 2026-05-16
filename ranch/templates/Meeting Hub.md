---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
tags:
  - "{{vault_identity_tag}}"
  - meetings-hub
  - <% tp.date.now("YYYY/MM/DD") %>
cssclasses:
  - wide
  - cards
  - cards-cols-2
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
// entity-create:meeting — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "meeting" });
```


---

## Today's Meetings

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });
```

---
